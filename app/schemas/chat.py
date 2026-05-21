from pydantic import BaseModel, Field, model_validator


class ChatRequest(BaseModel):
    message: str | None = Field(default=None, max_length=4000)
    retry_message_id: int | None = None
    edit_message_id: int | None = None

    @model_validator(mode="after")
    def validate_chat_request(self) -> "ChatRequest":
        if self.retry_message_id is not None and self.edit_message_id is not None:
            raise ValueError("Choose either retry_message_id or edit_message_id, not both.")

        clean_message = self.message.strip() if self.message else ""
        if self.edit_message_id is not None and not clean_message:
            raise ValueError("message is required when editing a message.")

        if self.retry_message_id is None and self.edit_message_id is None and not clean_message:
            raise ValueError("message is required.")

        if clean_message:
            self.message = clean_message

        return self
