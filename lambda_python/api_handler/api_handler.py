import json
import os
import logging

# Set up logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Example: Get environment variables (replace with actual usage)
TABLE_NAME = os.environ.get('DDB_TABLE_NAME')
BUCKET_NAME = os.environ.get('USER_BUCKET_NAME')

def handler(event, context):
    """
    Handles API Gateway requests.
    """
    logger.info("API Event Received: %s", json.dumps(event))

    # Extract request details (example for HTTP API payload format v2.0)
    http_method = event.get('requestContext', {}).get('http', {}).get('method')
    path = event.get('requestContext', {}).get('http', {}).get('path')
    route_key = event.get('routeKey') # e.g., "GET /users/{userId}" or "ANY /users/{proxy+}"
    path_parameters = event.get('pathParameters', {})
    query_parameters = event.get('queryStringParameters', {})
    body_str = event.get('body', '{}') # Request body as string

    try:
        # Attempt to parse JSON body if present
        body = json.loads(body_str) if body_str else {}
    except json.JSONDecodeError:
        logger.error("Could not decode JSON body: %s", body_str)
        return {
            'statusCode': 400,
            'headers': { 'Content-Type': 'application/json' },
            'body': json.dumps({'error': 'Invalid JSON format in request body'})
        }

    logger.info("RouteKey: %s, Method: %s, Path: %s", route_key, http_method, path)
    logger.info("Path Params: %s, Query Params: %s", path_parameters, query_parameters)
    logger.info("Body: %s", body)

    # --- TODO: Implement your API logic here ---
    # Based on route_key, http_method, path_parameters, query_parameters, body
    # Use boto3 (included in runtime) to interact with DDB, S3, SQS, SNS
    # Example: if route_key == "GET /users/{userId}": fetch_user(path_parameters['userId'])

    response_body = {
        'message': f'Request received by Python API handler for route: {route_key}',
        'tableName': TABLE_NAME,
        'bucketName': BUCKET_NAME,
        # Avoid logging/returning raw event in production
    }

    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            # Add CORS headers if not handled by API Gateway integration response
            'Access-Control-Allow-Origin': '*', # Restrict in production!
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': 'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'
        },
        'body': json.dumps(response_body)
    }

# --- Add helper functions below for interacting with AWS services ---
# import boto3
# dynamodb = boto3.resource('dynamodb')
# table = dynamodb.Table(TABLE_NAME)
# etc.