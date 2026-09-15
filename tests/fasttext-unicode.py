"""Regression: load the real FastText model at a Unicode absolute path."""
from pathlib import Path
import sys
import hashlib
import fasttext
model = Path(sys.argv[1]).resolve()
assert not str(model).isascii(), 'Test needs a non-ASCII model path'
before = hashlib.sha256(model.read_bytes()).hexdigest()
loaded = fasttext.load_model(str(model))
assert loaded.predict('This is a short diagnostic sentence about physics education.')[0][0] == '__label__en'
assert hashlib.sha256(model.read_bytes()).hexdigest() == before
assert not list(Path.cwd().glob('.mineru-fasttext-*')), 'Temporary model copy leaked'
print('PASS: real FastText Unicode absolute path, prediction, source preserved, temporary copy cleaned')
