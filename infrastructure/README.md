# CI/CD Pipeline for ECS Application


Repository from [exanubes.com](https://exanubes.com) for [CI/CD pipeline for ECS application](https://exanubes.com/blog/ci-cd-pipeline-for-ecs-application).


This repository is using AWS CDK v2 and is not compatible with AWS CDK v1 bootstrap stack.

## Commands:

Run the following commands for building, deploying and destroying stacks

```
npm run build
npm run cdk:deploy -- --all
npm run cdk:destroy -- --all
```


Both of these commands use the `aws-cli sts` service to get the account id and aws IAM role `exanubes-cloudformation-access` in order to dynamically provide role arn. Make sure you're using the account you want to deploy the stacks to and that you have the role created either with the same name or different name and change the scripts in `package.json`.
