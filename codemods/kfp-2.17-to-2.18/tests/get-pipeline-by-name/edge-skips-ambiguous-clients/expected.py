import kfp
from kfp_server_api.models import GetPipelineByNameRequest

a = kfp.Client(namespace="team-a")
b = kfp.Client(namespace="team-b")
request = GetPipelineByNameRequest(name="training")
