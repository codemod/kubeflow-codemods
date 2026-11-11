import kfp

client = kfp.Client(namespace="team-a")
# kfp-shared
pipeline_id = client.get_pipeline_id("training")
