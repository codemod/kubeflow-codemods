from kfp import Client as KfpClient

client = KfpClient(host="https://example", namespace="team-a")
pipeline_id = client.get_pipeline_id(name="training")
