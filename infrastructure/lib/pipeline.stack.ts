import {SecretValue, Stack, StackProps} from "aws-cdk-lib";
import {Construct} from "constructs";
import {
    BuildEnvironmentVariableType,
    BuildSpec,
    EventAction,
    FilterGroup,
    GitHubSourceCredentials, LinuxBuildImage,
    Project,
    Source
} from "aws-cdk-lib/aws-codebuild";
import {ContainerDefinition, IBaseService, ICluster} from "aws-cdk-lib/aws-ecs";
import {PolicyStatement} from "aws-cdk-lib/aws-iam";
import {IRepository} from "aws-cdk-lib/aws-ecr";
import {Artifact, ArtifactPath, Pipeline} from "aws-cdk-lib/aws-codepipeline";
import {
    CodeBuildAction,
    EcsDeployAction,
    GitHubSourceAction,
    GitHubTrigger
} from "aws-cdk-lib/aws-codepipeline-actions";



interface Props extends StackProps {
    repository: IRepository
    service: IBaseService
    cluster: ICluster
    container: ContainerDefinition
}

const secretConfig = {
    arn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:github/token',
    id: 'github/token'
}

const githubConfig = {
    owner: 'exanubes',
    repo: 'ecs-fargate-ci-cd-pipeline',
    branch: 'master'
}

export class PipelineStack extends Stack {
    constructor(scope: Construct, id: string, private readonly props: Props) {
        super(scope, id, props)
        new GitHubSourceCredentials(this, "code-build-credentials", {
            accessToken: SecretValue.secretsManager(secretConfig.id),
        })

        const source = Source.gitHub({
            owner: githubConfig.owner,
            repo: githubConfig.repo,
            webhook: true,
            webhookFilters: [
                FilterGroup.inEventOf(EventAction.PUSH).andBranchIs(githubConfig.branch),
            ],
        })

        const stack = Stack.of(this)
        const buildSpec = this.getBuildSpec()

        const project = new Project(this, "project", {
            projectName: "pipeline-project",
            buildSpec,
            source,
            environment: {
                buildImage: LinuxBuildImage.AMAZON_LINUX_2_ARM_2,
                privileged: true,
            },
            environmentVariables: {
                REPOSITORY_URI: {
                    value: props.repository.repositoryUri,
                },
                AWS_ACCOUNT_ID: {
                    value: stack.account,
                },
                AWS_STACK_REGION: {
                    value: stack.region,
                },
                GITHUB_AUTH_TOKEN: {
                    type: BuildEnvironmentVariableType.SECRETS_MANAGER,
                    value: secretConfig.arn,
                },
                CONTAINER_NAME: {
                    value: props.container.containerName,
                },
            },
        })

        project.addToRolePolicy(
            new PolicyStatement({
                actions: ["secretsmanager:GetSecretValue"],
                resources: [secretConfig.arn],
            })
        )
        props.repository.grantPullPush(project.grantPrincipal)

        const artifacts = {
            source: new Artifact("Source"),
            build: new Artifact("BuildOutput"),
        }

        const pipelineActions = {
            source: new GitHubSourceAction({
                actionName: "Github",
                owner: githubConfig.owner,
                repo: githubConfig.repo,
                branch: githubConfig.branch,
                oauthToken: SecretValue.secretsManager("github/cdk-pipeline"),
                output: artifacts.source,
                trigger: GitHubTrigger.WEBHOOK,
            }),
            build: new CodeBuildAction({
                actionName: "CodeBuild",
                project,
                input: artifacts.source,
                outputs: [artifacts.build],
            }),
            deploy: new EcsDeployAction({
                actionName: "ECSDeploy",
                service: props.service,
                imageFile: new ArtifactPath(
                    artifacts.build,
                    "docker_image_definition.json"
                ),
            }),
        }

        const pipeline = new Pipeline(this, "DeployPipeline", {
            pipelineName: `exanubes-pipeline`,
            stages: [
                { stageName: "Source", actions: [pipelineActions.source] },
                { stageName: "Build", actions: [pipelineActions.build] },
                { stageName: "Deploy", actions: [pipelineActions.deploy] },
            ],
        })

    }

    private getBuildSpec() {
        return BuildSpec.fromObject({
            version: '0.2',
            env: {
                shell: 'bash'
            },
            phases: {
                pre_build: {
                    commands: [
                        'echo logging in to AWS ECR',
                        'aws --version',
                        'echo $AWS_STACK_REGION',
                        'echo $CONTAINER_NAME',
                        'aws ecr get-login-password --region ${AWS_STACK_REGION} | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_STACK_REGION}.amazonaws.com',
                        'COMMIT_HASH=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)',
                        'echo $COMMIT_HASH',
                        'IMAGE_TAG=${COMMIT_HASH:=latest}',
                        'echo $IMAGE_TAG'
                    ],
                },
                build: {
                    commands: [
                        'echo Build started on `date`',
                        'echo Build Docker image',
                        'docker build -f ${CODEBUILD_SRC_DIR}/backend/Dockerfile -t ${REPOSITORY_URI}:latest ./backend',
                        'echo Running "docker tag ${REPOSITORY_URI}:latest ${REPOSITORY_URI}:${IMAGE_TAG}"',
                        'docker tag ${REPOSITORY_URI}:latest ${REPOSITORY_URI}:${IMAGE_TAG}'
                    ],
                },
                post_build: {
                    commands: [
                        'echo Build completed on `date`',
                        'echo Push Docker image',
                        'docker push ${REPOSITORY_URI}:latest',
                        'docker push ${REPOSITORY_URI}:${IMAGE_TAG}',
                        'printf "[{\\"name\\": \\"$CONTAINER_NAME\\", \\"imageUri\\": \\"$REPOSITORY_URI:$IMAGE_TAG\\"}]" > docker_image_definition.json'
                    ]
                }
            },
            artifacts: {
                files: ['docker_image_definition.json']
            },
        })
    }

}

