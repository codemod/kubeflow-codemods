import kfp
import os

client = kfp.Client(namespace=os.environ["NS"])
pipeline_id = client.get_pipeline_id("training")
