import kfp

client = kfp.Client(namespace="team-a")
# intentional shared
response = client.list_pipelines(page_size=20)
