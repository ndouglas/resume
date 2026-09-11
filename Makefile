.PHONY: test build build-all clean
PROFILE ?= commercial-senior-swe

test:
	python3 -m pytest -q

build:
	python3 build.py --profile $(PROFILE)

build-all:
	python3 build.py --all

clean:
	rm -rf build dist
