#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { AiNocStack } from "./stack";

const app = new cdk.App();

new AiNocStack(app, "AiNocStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  },
  description: "AI Operations Center — feed aggregator with real-time monitoring",
});
