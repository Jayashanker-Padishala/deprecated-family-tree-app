import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
// Removed: import * as nodeLambda from '@aws-cdk/aws-lambda-nodejs'; // No longer needed
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as apigwv2 from '@aws-cdk/aws-apigatewayv2-alpha';
import * as apiIntegrations from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import * as apiAuthorizers from '@aws-cdk/aws-apigatewayv2-authorizers-alpha';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import path = require('path');

export class FamilyTreeAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // --- Cognito User Pool (No changes needed) ---
    const userPool = new cognito.UserPool(this, 'FamilyTreeUserPool', {
      userPoolName: 'family-tree-user-pool',
      selfSignUpEnabled: true,
      accountRecovery: cognito.AccountRecovery.PHONE_AND_EMAIL,
      signInAliases: { email: true, phone: true },
      userVerification: {
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      standardAttributes: {
        email: { required: true, mutable: true },
        phoneNumber: { required: false, mutable: true },
        givenName: { required: false, mutable: true },
        familyName: { required: false, mutable: true },
      },
      passwordPolicy: {
        minLength: 8, requireLowercase: true, requireUppercase: true, requireDigits: true, requireSymbols: false,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoVerify: { email: true },
    });
    const userPoolClient = userPool.addClient('FamilyTreeAppClient', {
      userPoolClientName: 'family-tree-web-client',
      oAuth: {
        flows: { authorizationCodeGrant: true, implicitCodeGrant: true },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE, cognito.OAuthScope.PHONE],
        callbackUrls: ['http://localhost:3000/callback'], // Replace with your actual frontend URL(s)
        logoutUrls: ['http://localhost:3000/logout'], // Replace with your actual frontend URL(s)
      },
      authFlows: { userSrp: true, custom: true, userPassword: true },
    });

    // --- DynamoDB Table (No changes needed) ---
    const dataTable = new dynamodb.Table(this, 'FamilyTreeDataTable', {
      tableName: 'FamilyTreeData',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Use RETAIN in production!
    });

    // --- S3 Bucket for User Storage (No changes needed) ---
    const userStorageBucket = new s3.Bucket(this, 'UserStorageBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Use RETAIN in production!
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.DELETE, s3.HttpMethods.HEAD],
          allowedOrigins: ['http://localhost:3000', '*'], // IMPORTANT: Restrict this in production!
          allowedHeaders: ['*'], maxAge: 3000,
        },
      ],
    });

    // --- SQS Queues (No changes needed) ---
    const duplicateCheckQueue = new sqs.Queue(this, 'DuplicateCheckQueue', {
      queueName: 'family-tree-duplicate-checks.fifo', fifo: true, contentBasedDeduplication: true,
      visibilityTimeout: cdk.Duration.minutes(5), retentionPeriod: cdk.Duration.days(4),
    });
    const adminApprovalQueue = new sqs.Queue(this, 'AdminApprovalQueue', {
      queueName: 'family-tree-admin-approvals', visibilityTimeout: cdk.Duration.minutes(10),
    });

    // --- SNS Topic (No changes needed) ---
    const notificationTopic = new sns.Topic(this, 'NotificationTopic', {
      topicName: 'family-tree-notifications', displayName: 'Family Tree App Notifications',
    });

    // --- Environment Variables for Lambdas ---
     const lambdaEnvironment = {
        DDB_TABLE_NAME: dataTable.tableName,
        USER_BUCKET_NAME: userStorageBucket.bucketName,
        DUPLICATE_QUEUE_URL: duplicateCheckQueue.queueUrl,
        ADMIN_QUEUE_URL: adminApprovalQueue.queueUrl,
        NOTIFICATION_TOPIC_ARN: notificationTopic.topicArn,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        // Add other environment variables if needed
      };

    // --- Python Lambda Functions ---
    const pythonRuntime = lambda.Runtime.PYTHON_3_11; // Choose your desired Python runtime

    // Lambda for handling API requests (Python)
    const apiHandlerLambda = new lambda.Function(this, 'ApiHandlerLambda', {
      runtime: pythonRuntime,
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda_python/api_handler')), // Path to Python code
      handler: 'api_handler.handler', // Points to the handler function in api_handler.py
      environment: lambdaEnvironment,
      timeout: cdk.Duration.seconds(30),
      memorySize: 128, // Adjust as needed
      functionName: 'family-tree-api-handler-python',
      // CDK automatically handles requirements.txt bundling if Docker is running
    });

    // Lambda for processing SQS messages (Python)
    const sqsProcessorLambda = new lambda.Function(this, 'SqsProcessorLambda', {
      runtime: pythonRuntime,
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda_python/sqs_processor')), // Path to Python code
      handler: 'sqs_processor.handler', // Points to the handler function in sqs_processor.py
      environment: lambdaEnvironment,
      timeout: cdk.Duration.minutes(5), // Allow more time for SQS processing
      memorySize: 128,
      functionName: 'family-tree-sqs-processor-python',
    });
    // Trigger SQS processor from the queues
    sqsProcessorLambda.addEventSourceMapping('DuplicateCheckSource', {
        eventSourceArn: duplicateCheckQueue.queueArn, batchSize: 5,
    });
     sqsProcessorLambda.addEventSourceMapping('AdminApprovalSource', {
        eventSourceArn: adminApprovalQueue.queueArn, batchSize: 1,
    });

    // Lambda for scheduled tasks (Python)
    const scheduledTaskLambda = new lambda.Function(this, 'ScheduledTaskLambda', {
      runtime: pythonRuntime,
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda_python/scheduled_task')), // Path to Python code
      handler: 'scheduled_task.handler', // Points to the handler function in scheduled_task.py
      environment: lambdaEnvironment,
      timeout: cdk.Duration.minutes(5), // Allow more time for scheduled tasks
      memorySize: 128,
      functionName: 'family-tree-scheduled-task-python',
    });

    // --- Grant Permissions (No changes needed in *what* permissions are granted) ---
    dataTable.grantReadWriteData(apiHandlerLambda);
    userStorageBucket.grantReadWrite(apiHandlerLambda);
    adminApprovalQueue.grantSendMessages(apiHandlerLambda);
    notificationTopic.grantPublish(apiHandlerLambda);
    userPool.grant(apiHandlerLambda, 'cognito-idp:AdminGetUser', 'cognito-idp:ListUsers');

    dataTable.grantReadWriteData(sqsProcessorLambda);
    duplicateCheckQueue.grantConsumeMessages(sqsProcessorLambda);
    adminApprovalQueue.grantConsumeMessages(sqsProcessorLambda);
    notificationTopic.grantPublish(sqsProcessorLambda);

    dataTable.grantReadData(scheduledTaskLambda);
    duplicateCheckQueue.grantSendMessages(scheduledTaskLambda);

    // Allow Lambda to generate pre-signed URLs for S3 (policy remains the same)
    const s3PolicyStatement = new iam.PolicyStatement({
        actions: ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
        resources: [`${userStorageBucket.bucketArn}/*`],
    });
    apiHandlerLambda.addToRolePolicy(s3PolicyStatement);

    // --- API Gateway (HTTP API) (No changes needed) ---
    const httpApi = new apigwv2.HttpApi(this, 'FamilyTreeHttpApi', {
      apiName: 'FamilyTreeAPI', description: 'API for the Family Tree Application',
      corsPreflight: {
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Amz-Security-Token'],
        allowMethods: [apigwv2.CorsHttpMethod.OPTIONS, apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.PUT, apigwv2.CorsHttpMethod.PATCH, apigwv2.CorsHttpMethod.DELETE],
        allowOrigins: ['http://localhost:3000', '*'], // IMPORTANT: Restrict this in production!
        maxAge: cdk.Duration.days(1),
      },
    });
    const authorizer = new apiAuthorizers.HttpUserPoolAuthorizer('CognitoAuthorizer', userPool, {
        userPoolClients: [userPoolClient], identitySource: ['$request.header.Authorization'],
    });
    const apiIntegration = new apiIntegrations.HttpLambdaIntegration('ApiIntegration', apiHandlerLambda);
    // Define API Routes (examples)
    httpApi.addRoutes({ path: '/users/{proxy+}', methods: [apigwv2.HttpMethod.ANY], integration: apiIntegration, authorizer: authorizer });
    httpApi.addRoutes({ path: '/families/{proxy+}', methods: [apigwv2.HttpMethod.ANY], integration: apiIntegration, authorizer: authorizer });
    httpApi.addRoutes({ path: '/persons/{proxy+}', methods: [apigwv2.HttpMethod.ANY], integration: apiIntegration, authorizer: authorizer });

    // --- EventBridge Scheduled Rule (No changes needed) ---
    const dailyScheduleRule = new events.Rule(this, 'DailyDuplicateCheckRule', {
      ruleName: 'family-tree-daily-duplicate-check', description: 'Triggers the duplicate check Lambda function daily',
      schedule: events.Schedule.cron({ minute: '0', hour: '2' }), enabled: true,
    });
    dailyScheduleRule.addTarget(new targets.LambdaFunction(scheduledTaskLambda));

    // --- CloudFormation Outputs (No changes needed) ---
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'DataTableName', { value: dataTable.tableName });
    new cdk.CfnOutput(this, 'UserBucketName', { value: userStorageBucket.bucketName });
    new cdk.CfnOutput(this, 'ApiEndpoint', { value: httpApi.url! });
    new cdk.CfnOutput(this, 'NotificationTopicArn', { value: notificationTopic.topicArn });
  }
}