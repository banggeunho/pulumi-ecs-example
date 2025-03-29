import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

// 1. VPC
const vpc = new aws.ec2.Vpc("vpc", {
    cidrBlock: "10.0.0.0/16",
    enableDnsHostnames: true,
    enableDnsSupport: true,
});

// Subnet 1 (ap-northeast-2a)
const subnet1 = new aws.ec2.Subnet("subnet1", {
    vpcId: vpc.id,
    cidrBlock: "10.0.1.0/24",
    availabilityZone: "ap-northeast-2a",
    mapPublicIpOnLaunch: true,
});

// Subnet 2 (ap-northeast-2c)
const subnet2 = new aws.ec2.Subnet("subnet2", {
    vpcId: vpc.id,
    cidrBlock: "10.0.2.0/24",
    availabilityZone: "ap-northeast-2c",
    mapPublicIpOnLaunch: true,
});


// 3. Internet Gateway
const igw = new aws.ec2.InternetGateway("igw", {
    vpcId: vpc.id,
});

// 4. Route Table
const routeTable = new aws.ec2.RouteTable("routeTable", {
    vpcId: vpc.id,
    routes: [{
        cidrBlock: "0.0.0.0/0",
        gatewayId: igw.id,
    }],
});

// 각 서브넷에 라우팅 연결
new aws.ec2.RouteTableAssociation("rta1", {
    routeTableId: routeTable.id,
    subnetId: subnet1.id,
});

new aws.ec2.RouteTableAssociation("rta2", {
    routeTableId: routeTable.id,
    subnetId: subnet2.id,
});

// 6. Security Group for ALB
const albSg = new aws.ec2.SecurityGroup("albSg", {
    vpcId: vpc.id,
    ingress: [{
        protocol: "tcp",
        fromPort: 80,
        toPort: 80,
        cidrBlocks: ["0.0.0.0/0"],
    }],
    egress: [{
        protocol: "-1",
        fromPort: 0,
        toPort: 0,
        cidrBlocks: ["0.0.0.0/0"],
    }],
});

// 7. Security Group for ECS Task
const ecsSg = new aws.ec2.SecurityGroup("ecsSg", {
    vpcId: vpc.id,
    ingress: [{
        protocol: "tcp",
        fromPort: 80,
        toPort: 80,
        securityGroups: [albSg.id],
    }],
    egress: [{
        protocol: "-1",
        fromPort: 0,
        toPort: 0,
        cidrBlocks: ["0.0.0.0/0"],
    }],
});

// 8. ALB
const alb = new aws.lb.LoadBalancer("alb", {
    loadBalancerType: "application",
    subnets: [subnet1.id, subnet2.id],
    securityGroups: [albSg.id],
    internal: false,
});

// 9. Target Group
const targetGroup = new aws.lb.TargetGroup("targetGroup", {
    port: 80,
    protocol: "HTTP",
    targetType: "ip",
    vpcId: vpc.id,
});

// 10. Listener
new aws.lb.Listener("listener", {
    loadBalancerArn: alb.arn,
    port: 80,
    protocol: "HTTP",
    defaultActions: [{
        type: "forward",
        targetGroupArn: targetGroup.arn,
    }],
});

// 11. ECS Cluster
const cluster = new aws.ecs.Cluster("ecsCluster", {});

// ✅ 12. IAM Role (execution role)
const taskExecRole = new aws.iam.Role("ecsTaskExecutionRole", {
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Effect: "Allow",
            Principal: {
                Service: "ecs-tasks.amazonaws.com",
            },
            Action: "sts:AssumeRole",
        }],
    }),
});

// 정책 연결
new aws.iam.RolePolicyAttachment("taskExecRolePolicy", {
    role: taskExecRole.name,
    policyArn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
});

// 13. Task Definition
const containerDefString = JSON.stringify([{
    name: "nginx",
    image: "nginx",
    essential: true,
    portMappings: [{
        containerPort: 80,
        protocol: "tcp",
    }],
}]);

const taskDef = new aws.ecs.TaskDefinition("taskDef", {
    family: "nginx-task",
    cpu: "256",
    memory: "512",
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    executionRoleArn: taskExecRole.arn, // ✅ 교체됨
    containerDefinitions: containerDefString,
});

// 14. ECS Fargate Service
const service = new aws.ecs.Service("ecsService",
    {
        cluster: cluster.arn,
        taskDefinition: taskDef.arn,
        desiredCount: 1,
        launchType: "FARGATE",
        networkConfiguration: {
            subnets: [subnet1.id, subnet2.id],
            securityGroups: [ecsSg.id],
            assignPublicIp: true,
        },
        loadBalancers: [{
            targetGroupArn: targetGroup.arn,
            containerName: "nginx",
            containerPort: 80,
        }],
    },
    {
        dependsOn: [alb], // ✅ 여긴 ResourceOptions
    }
);

// 15. ALB 주소 출력
export const albDns = alb.dnsName;