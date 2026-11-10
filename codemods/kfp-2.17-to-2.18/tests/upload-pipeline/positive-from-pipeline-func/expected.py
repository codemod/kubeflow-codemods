import kfp
from kfp.client import Client

client = Client(namespace="team-a")
client.upload_pipeline_from_pipeline_func(my_pipeline, pipeline_name="training", namespace="team-a")
