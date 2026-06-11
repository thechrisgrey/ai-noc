import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as rds from "aws-cdk-lib/aws-rds";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53targets from "aws-cdk-lib/aws-route53-targets";
import { Construct } from "constructs";

export class AiNocStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const cfPrefixListId = this.node.tryGetContext("cfPrefixListId") ?? "pl-3b927c52";
    const imageTag = this.node.tryGetContext("imageTag") ?? "latest";
    const domainName = this.node.tryGetContext("domainName");
    const hostedZoneId = this.node.tryGetContext("hostedZoneId");
    const httpsEnabled = Boolean(domainName && hostedZoneId);
    const httpRedirect = httpsEnabled && this.node.tryGetContext("httpRedirect") === "true";
    const sesRegion = this.node.tryGetContext("sesRegion") ?? "us-east-1";

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
    albSg.addIngressRule(ec2.Peer.prefixList(cfPrefixListId), ec2.Port.tcp(80), "CloudFront origin-facing only");
    if (httpsEnabled) {
      albSg.addIngressRule(ec2.Peer.prefixList(cfPrefixListId), ec2.Port.tcp(443), "CloudFront origin-facing only");
    }

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
      deleteAutomatedBackups: false,
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      multiAz: false,
    });

    // Shared secret CloudFront attaches as the X-Origin-Verify header; the app
    // rejects requests that reach the ALB without it.
    const originVerifySecret = new secretsmanager.Secret(this, "OriginVerifySecret", {
      secretName: "ai-noc/origin-verify",
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 32,
      },
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
      image: ecs.ContainerImage.fromEcrRepository(repo, imageTag),
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
        BEDROCK_REGION: "us-east-1",
        TRUST_PROXY_HOPS: "2",
        RETENTION_DAYS: "90",
        EMBEDDINGS_ENABLED: "true",
        CLUSTER_SIM_THRESHOLD: "0.80",
        DIGEST_EMAIL_TO: "christian.perez@altivum.io",
        DIGEST_HOUR_UTC: "12",
      },
      secrets: {
        DB_USERNAME: ecs.Secret.fromSecretsManager(dbCredentials, "username"),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(dbCredentials, "password"),
        ORIGIN_VERIFY_TOKEN: ecs.Secret.fromSecretsManager(originVerifySecret),
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
      circuitBreaker: { enable: true, rollback: true },
      healthCheckGracePeriod: cdk.Duration.seconds(120),
    });

    // Grant Fargate task read access to the DB and origin-verify secrets
    dbCredentials.grantRead(taskDef.taskRole);
    originVerifySecret.grantRead(taskDef.taskRole);

    // Grant Bedrock InvokeModel for AI briefing generation
    taskDef.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [
          "arn:aws:bedrock:us-east-1::foundation-model/anthropic.*",
          `arn:aws:bedrock:us-east-1:${this.account}:inference-profile/us.anthropic.*`,
          "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v2:0",
        ],
      }),
    );

    // Grant SES SendEmail for the daily digest, scoped to verified identities in
    // the SES region. SES authorizes on the verified From identity, so the
    // resource is identity-scoped rather than wildcard-everything.
    taskDef.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail"],
        resources: [`arn:aws:ses:${sesRegion}:${this.account}:identity/*`],
      }),
    );

    // ─── Application Load Balancer ─────────────────────────
    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
    });

    const targetGroup = new elbv2.ApplicationTargetGroup(this, "FargateTargetGroup", {
      vpc,
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

    alb.addListener("HttpListener", {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: false,
      ...(httpRedirect
        ? {
            defaultAction: elbv2.ListenerAction.redirect({
              protocol: "HTTPS",
              port: "443",
              permanent: true,
            }),
          }
        : { defaultTargetGroups: [targetGroup] }),
    });

    // HTTPS listener + origin.<domain> alias, only once the delegated zone exists
    if (httpsEnabled) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
        hostedZoneId,
        zoneName: domainName,
      });

      const originCertificate = new acm.Certificate(this, "OriginCertificate", {
        domainName: `origin.${domainName}`,
        validation: acm.CertificateValidation.fromDns(zone),
      });

      alb.addListener("HttpsListener", {
        port: 443,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        open: false,
        certificates: [originCertificate],
        defaultTargetGroups: [targetGroup],
      });

      new route53.ARecord(this, "OriginAliasRecord", {
        zone,
        recordName: `origin.${domainName}`,
        target: route53.RecordTarget.fromAlias(new route53targets.LoadBalancerTarget(alb)),
      });
    }

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
