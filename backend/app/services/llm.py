from __future__ import annotations
import os, time
from typing import Type, TypeVar
from openai import AsyncOpenAI
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)

client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])

MODEL_REASONING = os.getenv("MODEL_REASONING", "gpt-4o")
MODEL_FAST      = os.getenv("MODEL_FAST",      "gpt-4o-mini")
MODEL_VISION    = os.getenv("MODEL_VISION",    "gpt-4o-mini")


async def structured_call(
    *,
    model: str,
    system: str,
    user_content: list | str,
    response_schema: Type[T],
    temperature: float = 1.0,
) -> tuple[T, int]:
    """Returns (parsed_response, latency_ms)."""
    t0 = time.monotonic()
    resp = await client.beta.chat.completions.parse(
        model=model,
        temperature=temperature,
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": user_content
             if isinstance(user_content, list) else [{"type": "text", "text": user_content}]},
        ],
        response_format=response_schema,
    )
    latency_ms = int((time.monotonic() - t0) * 1000)
    return resp.choices[0].message.parsed, latency_ms


async def text_call(
    *,
    model: str,
    system: str,
    user: str,
    temperature: float = 1.0,
) -> tuple[str, int]:
    """Free-text call (used for appeal letter drafting)."""
    t0 = time.monotonic()
    resp = await client.chat.completions.create(
        model=model,
        temperature=temperature,
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
    )
    latency_ms = int((time.monotonic() - t0) * 1000)
    return resp.choices[0].message.content, latency_ms
