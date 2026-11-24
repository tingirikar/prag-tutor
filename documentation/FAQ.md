### Q : when a teacher uploads a document, what exactly is happening?  
teachers clicks on upload documents.
windows explorer is opened and teacher selects a file
if that file is pdf => ok
if that file is NOT pdf => rejected
if teacher selects multiple pdf files
=> if sends one file at a time 
it also filters duplicate filenames (rejects duplicate files)

MUTLER - puts that uploaded files into uploads/
ex: uploads/dsa/documents/filename.pdf

if subject directory exists => keeps there
if not exists => creates that directory

mongodb -> records the files, name, size, subject, uploadedAt, status: "Uploaded", "Indexed"

then it sends
{
  "filename": ["example.pdf"],
  "subject": "CN"
}
to tutor/

now it does
-> verifies file exists
-> calculates MD5 hash
-> extracts valid images and saves them under the subject's image directory
-> reads PDF pages and extracts text
-> splits the text into chunks
-> generates embeddings to that chunks
-> uploads vectors to pinecode
-> pinecone indexes those vectors
-> writes file hash into mongodb
-> generates prerequisite topics and stores them in MONGODB
-> express marks them as "Indexed"
-> frontend is getting streamed progress events
-> at end it displays "Completed & Indexed"
