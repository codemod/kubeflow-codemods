import kfp

class Runner:
    def __init__(self):
        self._client = kfp.Client(namespace="team-a")

    def lookup(self):
        return self._client.get_pipeline_id("training", namespace="team-a")
