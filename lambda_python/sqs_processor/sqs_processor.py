import json
import os
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

DUPLICATE_QUEUE_URL = os.environ.get('DUPLICATE_QUEUE_URL')
ADMIN_QUEUE_URL = os.environ.get('ADMIN_QUEUE_URL')
TABLE_NAME = os.environ.get('DDB_TABLE_NAME')

def handler(event, context):
    """
    Processes messages from SQS queues.
    """
    logger.info("SQS Event Received: %s", json.dumps(event))

    for record in event.get('Records', []):
        try:
            queue_arn = record.get('eventSourceARN')
            message_id = record.get('messageId')
            logger.info("Processing message ID: %s from ARN: %s", message_id, queue_arn)

            message_body_str = record.get('body', '{}')
            message_body = json.loads(message_body_str)
            logger.info("Message Body: %s", json.dumps(message_body))

            # --- TODO: Implement processing logic based on queue and message body ---
            if queue_arn and DUPLICATE_QUEUE_URL and DUPLICATE_QUEUE_URL in queue_arn:
                logger.info("Processing duplicate check message...")
                # Logic for handling potential duplicates (e.g., update DDB, notify users via SNS)
                pass
            elif queue_arn and ADMIN_QUEUE_URL and ADMIN_QUEUE_URL in queue_arn:
                logger.info("Processing admin approval message...")
                # Logic for admin approvals (e.g., update status in DDB)
                pass
            else:
                logger.warning("Message from unknown queue ARN: %s", queue_arn)

            # Simulate work
            # import time; time.sleep(1)

            # Message processed successfully (Lambda deletes from queue on success)
            logger.info("Successfully processed message ID: %s", message_id)

        except Exception as e:
            logger.error("Error processing message ID %s: %s", record.get('messageId', 'N/A'), e, exc_info=True)
            # Throwing an error makes the message visible again based on queue's visibility timeout/redrive policy
            # Consider implementing more sophisticated error handling / DLQ strategy
            raise e