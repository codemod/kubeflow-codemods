import kfp

client = kfp.Client(namespace="team-a")
# kfp-shared
client.upload_pipeline(
    pipeline_package_path="pipeline.yaml",
    pipeline_name="training",
)
