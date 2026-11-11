import kfp

NS = "team-a"
client = kfp.Client(namespace=NS)
pipeline_id = client.get_pipeline_id("training")
