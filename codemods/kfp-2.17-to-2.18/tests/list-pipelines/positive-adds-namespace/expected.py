import kfp

client = kfp.Client(namespace="team-a")
response = client.list_pipelines(page_size=20, namespace="team-a")
