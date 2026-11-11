import kfp
from kfp_server_api.models import GetPipelineByNameRequest

a = kfp.Client(namespace="team-a")
b = kfp.Client(namespace="team-b")
api_a = a._pipelines_api
pipeline = api_a.pipeline_service_get_pipeline_by_name(name="training", namespace="team-a")
request = GetPipelineByNameRequest(name="training")
