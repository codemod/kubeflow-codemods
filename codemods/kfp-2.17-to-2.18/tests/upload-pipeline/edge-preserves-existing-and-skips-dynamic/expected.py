import kfp
import os

client = kfp.Client(namespace="team-a")
client.upload_pipeline(
    pipeline_package_path="pipeline.yaml",
    pipeline_name="training",
    namespace="team-a",
)

dynamic = kfp.Client(namespace=os.getenv("NS"))
dynamic.upload_pipeline("pipeline.yaml", pipeline_name="training")
