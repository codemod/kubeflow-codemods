from kfp_server_api.models import GetPipelineByNameRequest

request = GetPipelineByNameRequest(name="training")
url = "/apis/v2beta1/pipelines/names/training"
