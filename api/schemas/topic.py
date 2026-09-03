from pydantic import BaseModel


class TopicResponse(BaseModel):
    """One derived topic: a normalised tag key plus how many links carry it.

    Topics are not stored. They are a grouping over ``links.ai_tags`` computed on
    read, so a tag edited in the drawer changes the topic list immediately and
    there is no second copy of the truth to keep in sync.
    """

    #: Normalised grouping key — what ``GET /api/links?tag=`` expects.
    key: str
    #: The most common original spelling among the grouped tags, for display.
    label: str
    #: Distinct links carrying this topic, under the same status filter the
    #: link list uses, so the count matches what clicking through returns.
    count: int
