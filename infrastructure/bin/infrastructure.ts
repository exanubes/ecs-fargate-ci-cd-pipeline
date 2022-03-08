#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import {EcrStack} from "../lib/ecr.stack";
import {VpcStack} from "../lib/vpc.stack";
import {ElasticContainerStack} from "../lib/elastic-container.stack";
import {Route53Stack} from "../lib/route53.stack";
import {Environment, Tags} from "aws-cdk-lib";
import {PipelineStack} from "../lib/pipeline.stack";
import {getAccountId, getRegion, resolveCurrentUserOwnerName} from "@exanubes/cdk-utils";


async function start(): Promise<void> {
    const owner = await resolveCurrentUserOwnerName()
    const account = await getAccountId()
    const region = await getRegion()

    const env: Environment = {account, region}
    const app = new cdk.App()
    const ecr = new EcrStack(app, EcrStack.name, {env})
    const vpc = new VpcStack(app, VpcStack.name, {env})
    const ecs = new ElasticContainerStack(app, ElasticContainerStack.name, {
        vpc: vpc.vpc,
        repository: ecr.repository,
        env,
    })
    new Route53Stack(app, Route53Stack.name, {
        loadBalancer: ecs.loadBalancer,
        env,
    })
    new PipelineStack(app, PipelineStack.name, {
        repository: ecr.repository,
        service: ecs.service,
        cluster: ecs.cluster,
        container: ecs.container,
        env,
    })
    Tags.of(app).add("owner", owner)
}

start().catch(error => {
    console.log(error)
    process.exit(1)
})
