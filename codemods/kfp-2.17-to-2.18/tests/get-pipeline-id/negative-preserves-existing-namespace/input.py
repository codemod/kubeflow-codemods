import kfp

client = kfp.Client(namespace="team-a")
pipeline_id = client.get_pipeline_id("training", namespace="shared")
