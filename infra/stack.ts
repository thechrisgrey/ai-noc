import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as rds from "aws-cdk-lib/aws-rds";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

export class AiNocStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─── VPC ───────────────────────────────────────────────
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { cidrMask: 24, name: "Public", subnetType: ec2.SubnetType.PUBLIC },
        { cidrMask: 24, name: "Private", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      ],
    });

    // ─── Security Groups ───────────────────────────────────
    const albSg = new ec2.SecurityGroup(this, "AlbSg", {
      vpc,
      description: "ALB - accepts HTTP/HTTPS from internet",
      allowAllOutbound: true,
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "HTTP");
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS");

    const fargateSg = new ec2.SecurityGroup(this, "FargateSg", {
      vpc,
      description: "Fargate - accepts traffic from ALB only",
      allowAllOutbound: true,
    });
    fargateSg.addIngressRule(albSg, ec2.Port.tcp(5000), "From ALB");

    const dbSg = new ec2.SecurityGroup(this, "DbSg", {
      vpc,
      description: "RDS - accepts traffic from Fargate only",
      allowAllOutbound: false,
    });
    dbSg.addIngressRule(fargateSg, ec2.Port.tcp(5432), "From Fargate");

    // ─── RDS PostgreSQL ────────────────────────────────────
    const dbCredentials = new secretsmanager.Secret(this, "DbCredentials", {
      secretName: "ai-noc/db-credentials",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "ainoc" }),
        generateStringKey: "password",
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    const database = new rds.DatabaseInstance(this, "Database", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_4,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [dbSg],
      databaseName: "ainoc",
      credentials: rds.Credentials.fromSecret(dbCredentials),
      allocatedStorage: 20,
      maxAllocatedStorage: 50,
      backupRetention: cdk.Duration.days(7),
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      multiAz: false,
    });

    // ─── ECR Repository ────────────────────────────────────
    // ECR repo created externally (before first stack deploy so image exists)
    const repo = ecr.Repository.fromRepositoryName(this, "Repo", "ai-noc");

    // ─── ECS Cluster + Fargate Service ─────────────────────
    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      clusterName: "ai-noc",
    });

    const taskDef = new ecs.FargateTaskDefinition(this, "TaskDef", {
      memoryLimitMiB: 512,
      cpu: 256,
    });

    // Pass DB credentials as ECS secrets (injected at runtime from Secrets Manager).
    // The app constructs DATABASE_URL from individual components.
    const container = taskDef.addContainer("app", {
      image: ecs.ContainerImage.fromEcrRepository(repo, "latest"),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "ai-noc",
        logRetention: logs.RetentionDays.TWO_WEEKS,
      }),
      environment: {
        NODE_ENV: "production",
        PORT: "5000",
        HOST: "0.0.0.0",
        DB_HOST: database.instanceEndpoint.hostname,
        DB_PORT: "5432",
        DB_NAME: "ainoc",
      },
      secrets: {
        DB_USERNAME: ecs.Secret.fromSecretsManager(dbCredentials, "username"),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(dbCredentials, "password"),
      },
      healthCheck: {
        command: ["CMD-SHELL", "wget -qO- http://localhost:5000/api/health || exit 1"],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(30),
      },
    });

    container.addPortMappings({ containerPort: 5000 });

    const service = new ecs.FargateService(this, "Service", {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      securityGroups: [fargateSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
      circuitBreaker: { enable: false },
      healthCheckGracePeriod: cdk.Duration.seconds(120),
    });

    // Grant Fargate task read access to the DB secret
    dbCredentials.grantRead(taskDef.taskRole);

    // ─── Application Load Balancer ─────────────────────────
    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
    });

    // HTTP listener (add HTTPS + ACM certificate when domain is configured)
    const listener = alb.addListener("HttpListener", {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
    });

    listener.addTargets("FargateTarget", {
      port: 5000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: {
        path: "/api/health",
        interval: cdk.Duration.seconds(30),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 5,
      },
      stickinessCookieDuration: cdk.Duration.hours(1),
    });

    // ─── Outputs ───────────────────────────────────────────
    new cdk.CfnOutput(this, "AlbDnsName", {
      value: alb.loadBalancerDnsName,
      description: "ALB DNS — use in Amplify proxy rewrites or point domain here",
    });

    new cdk.CfnOutput(this, "EcrRepoUri", {
      value: repo.repositoryUri,
      description: "ECR repo URI — docker push target",
    });

    new cdk.CfnOutput(this, "DbEndpoint", {
      value: database.instanceEndpoint.hostname,
      description: "RDS PostgreSQL endpoint",
    });

    new cdk.CfnOutput(this, "DbSecretArn", {
      value: dbCredentials.secretArn,
      description: "Database credentials secret ARN",
    });
  }
}
