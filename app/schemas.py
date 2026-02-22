from pydantic import BaseModel
from typing import List

class LotteryConfig(BaseModel):
    participants: int
    user_ticket: List[int]
    winning_ticket: List[int]