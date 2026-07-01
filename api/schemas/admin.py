from pydantic import BaseModel


class TrafficPoint(BaseModel):
    date: str  # YYYY-MM-DD (UTC)
    requests: int
    errors: int
    unique_visitors: int


class SignupPoint(BaseModel):
    date: str  # YYYY-MM-DD (UTC)
    signups: int


class StatsTotals(BaseModel):
    users: int
    verified: int
    requests_today: int
    unique_today: int


class AdminStatsResponse(BaseModel):
    traffic: list[TrafficPoint]
    user_growth: list[SignupPoint]
    totals: StatsTotals
