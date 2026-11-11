import kfp

client = kfp.Client(namespace="team-a")
client.upload_pipeline_version(
    pipeline_package_path="pipeline.yaml",
    pipeline_version_name="revision-2",
    pipeline_id="abc-123",
)
