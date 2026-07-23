from pydantic import BaseModel, Field


class AccountDeleteRequest(BaseModel):
    password: str = Field(..., min_length=1)
