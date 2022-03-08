import {IVpc, Peer, Port, SecurityGroup} from "aws-cdk-lib/aws-ec2";
import {Duration, Stack, StackProps} from "aws-cdk-lib";
import {Construct} from "constructs";
import {IRepository} from "aws-cdk-lib/aws-ecr";
import {
    Cluster, ContainerDefinition,
    CpuArchitecture,
    EcrImage,
    FargateService,
    FargateTaskDefinition,
    OperatingSystemFamily
} from "aws-cdk-lib/aws-ecs";
import {
    ApplicationLoadBalancer,
    ApplicationProtocol,
    ApplicationProtocolVersion,
    ListenerAction,
    SslPolicy
} from "aws-cdk-lib/aws-elasticloadbalancingv2";


interface Props extends StackProps {
    vpc: IVpc
    repository: IRepository
}

const CONTAINER_PORT = 8081
const CERTIFICATE_ARN = "arn:aws:acm:eu-central-1:123456789012:certificate/uuid"

export class ElasticContainerStack extends Stack {
    public readonly loadBalancer: ApplicationLoadBalancer
    public readonly container: ContainerDefinition
    public readonly service: FargateService
    public readonly cluster: Cluster

    constructor(scope: Construct, id: string, props: Props) {
        super(scope, id, props)
        this.cluster = new Cluster(this, "exanubes-cluster", {
            vpc: props.vpc,
            clusterName: "exanubes-cluster",
            containerInsights: true,
        })

        const albSg = new SecurityGroup(this, "security-group-load-balancer", {
            vpc: props.vpc,
            allowAllOutbound: true,
        })
        albSg.addIngressRule(Peer.anyIpv4(), Port.tcp(443))

        this.loadBalancer = new ApplicationLoadBalancer(this, "exanubes-alb", {
            vpc: props.vpc,
            loadBalancerName: "exanubes-ecs-alb",
            internetFacing: true,
            idleTimeout: Duration.minutes(10),
            securityGroup: albSg,
            http2Enabled: false,
            deletionProtection: false,
        })

        const httpListener = this.loadBalancer.addListener("http listener", {
            port: 80,
            open: true,
            defaultAction: ListenerAction.redirect({
                port: "443",
                protocol: ApplicationProtocol.HTTPS,
            }),
        })

        const sslListener = this.loadBalancer.addListener("secure https listener", {
            port: 443,
            open: true,
            sslPolicy: SslPolicy.RECOMMENDED,
            certificates: [{certificateArn: CERTIFICATE_ARN}],
        })

        const targetGroup = sslListener.addTargets('tcp-listener-target', {
            targetGroupName: 'tcp-target-ecs-service',
            protocol: ApplicationProtocol.HTTP,
            protocolVersion: ApplicationProtocolVersion.HTTP1,
        })

        const taskDefinition = new FargateTaskDefinition(
            this,
            "fargate-task-definition",
            {
                runtimePlatform: {
                    cpuArchitecture: CpuArchitecture.ARM64,
                    operatingSystemFamily: OperatingSystemFamily.LINUX,
                },
            }
        )
        this.container = taskDefinition.addContainer("web-server", {
            image: EcrImage.fromEcrRepository(props.repository),
        })
        this.container.addPortMappings({
            containerPort: CONTAINER_PORT,
        })


        const securityGroup = new SecurityGroup(this, "http-sg", {
            vpc: props.vpc,
        })
        securityGroup.addIngressRule(
            Peer.securityGroupId(albSg.securityGroupId),
            Port.tcp(CONTAINER_PORT),
            "Allow inbound connections from ALB"
        )
        this.service = new FargateService(this, "fargate-service", {
            cluster: this.cluster,
            assignPublicIp: false,
            taskDefinition,
            securityGroups: [securityGroup],
            desiredCount: 1,
            maxHealthyPercent: 100
        })

        targetGroup.addTarget(this.service)


    }
}
