FROM ubuntu:20.04
LABEL maintainer="blobtoolkit@genomehubs.org"
LABEL license="MIT"
LABEL version=$VERSION
ARG VERSION
ENV CONTAINER_VERSION=$VERSION

RUN apt-get update \
    && DEBIAN_FRONTEND="noninteractive" apt-get -y --no-install-recommends install \
    aria2 \
    build-essential \
    dbus-x11 \
    firefox \
    firefox-geckodriver \
    rsync \
    ttf-mscorefonts-installer \
    wget \
    xvfb \
    x11-utils

RUN mkdir -p /blobtoolkit/conf \
    && mkdir -p /blobtoolkit/data/assembly \
    && mkdir -p /blobtoolkit/data/reads \
    && mkdir -p /blobtoolkit/data/other \
    && mkdir -p /blobtoolkit/databases/busco \
    && mkdir -p /blobtoolkit/databases/ncbi_db \
    && mkdir -p /blobtoolkit/databases/ncbi_taxdump \
    && mkdir -p /blobtoolkit/databases/uniprot_db \
    && mkdir -p /blobtoolkit/datasets \
    && mkdir -p /blobtoolkit/output \
    && mkdir -p /nfs \
    && mkdir -p /lustre

RUN useradd -m blobtoolkit \
    && chown -R blobtoolkit:blobtoolkit /blobtoolkit \
    && chown -R blobtoolkit:blobtoolkit /nfs \
    && chown -R blobtoolkit:blobtoolkit /lustre

WORKDIR /opt

RUN wget -O Miniforge3.sh "https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-$(uname)-$(uname -m).sh" \
    bash Miniforge3.sh -b -p opt/conda \
    rm Miniforge3.sh

ARG CONDA_DIR=/opt/conda

COPY env.yaml /tmp/env.yaml

RUN $CONDA_DIR/bin/conda env create -f /tmp/env.yaml \
    && $CONDA_DIR/bin/conda clean --all --yes

USER blobtoolkit

RUN mkdir -p /blobtoolkit/.conda

ENV CONDA_DEFAULT_ENV $CONDA_DIR/envs/btk_env

ENV PATH $CONDA_DEFAULT_ENV/bin:$PATH

ENV PYTHONPATH $CONDA_DEFAULT_ENV/lib/python3.9/site-packages:$PYTHONPATH

WORKDIR /blobtoolkit

EXPOSE 8000 8080

CMD blobtools -h