import kfp

client = kfp.Client(namespace="kubeflow")
client.upload_pipeline(
    pipeline_package_path="pipeline.yaml",
    pipeline_name="training",
    namespace="kubeflow",
)
