.PHONY: test build build-all game serve clean
PROFILE ?= commercial-senior-swe

test:
	python3 -m pytest -q
	cd game && node --test test/*.test.js

build:
	python3 build.py --profile $(PROFILE)

build-all:
	python3 build.py --all

game:
	python3 build.py --game

serve: game
	python3 -m http.server -d dist 8000

clean:
	rm -rf build dist
