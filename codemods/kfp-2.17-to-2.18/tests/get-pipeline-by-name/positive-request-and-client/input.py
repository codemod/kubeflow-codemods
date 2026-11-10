import kfp
from kfp_server_api.models import GetPipelineByNameRequest

client = kfp.Client(namespace="team-a")
pipelines_api = client._pipelines_api

request = GetPipelineByNameRequest(
    name="training",
)
pipeline = pipelines_api.pipeline_service_get_pipeline_by_name(name="training")
url = "https://example.com/apis/v2beta1/pipelines/names/training"
