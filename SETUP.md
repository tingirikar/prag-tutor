# Setup PRAG-TUTOR on Windows
open command prompt and run these commands
ensure u have python 3.10+ version
```
python --version
node --version
npm --version
```
node.js and npm installed

### STEP 1 : clone PRAG-TUTOR repository
open command prompt, go to ur desired directory
and enter this command

(u can also open windows explorer, go to desired folder and enter ```cmd``` in path and use this command)


```bash
git clone https://github.com/tingirikar/PRAG-TUTOR.git
```

### STEP 2 : setup environment variable
fill api keys in .env
```
copy .env.example .env
```
or create .env file and paste contents of .env.example

now go to respective providers and get api keys

### STEP 3 : INSTALL DEPENDENCIES
```bash
cd tutor
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
cd ..
```

navigate to backend directory
```bash
cd backend
npm install
cd ..
```

navigate to frontend directory
```bash
cd frontend
npm install
cd ..
```

### STEP 4 : RUNNING PRAG-TUTOR

in terminal-1 (Tutor AI Service - PORT 8000)
```bash
cd tutor
py -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

in terminal-2 (Backend - PORT 5000)
```bash
cd backend
npm run dev
```

in terminal-3 (Frontend - PORT 5173)
```bash
cd frontend
npm run dev
```
