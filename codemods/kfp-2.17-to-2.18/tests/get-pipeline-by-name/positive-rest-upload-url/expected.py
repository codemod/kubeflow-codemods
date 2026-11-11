import kfp

client = kfp.Client(namespace="team-a")
upload_url = "https://example.com/apis/v2beta1/pipelines/upload?namespace=team-a"
