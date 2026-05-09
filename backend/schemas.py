from pydantic import BaseModel, EmailStr

class UserCreate(BaseModel):
    nom: str
    prenom: str
    email: EmailStr
    password: str

class UserOut(BaseModel):
    id: int
    nom: str
    prenom: str
    email: EmailStr
    class Config:
        orm_mode = True
