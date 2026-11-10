import kfp
from kfp_server_api.models import GetPipelineByNameRequest

client = kfp.Client(namespace="team-a")
request = GetPipelineByNameRequest(name="training", namespace="team-b")
url = "/apis/v2beta1/pipelines/names/training?namespace=team-b"
