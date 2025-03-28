#!/bin/bash

# Build and install the latest blobtoolkit version in the current environment

PLATFORM=$1

if [ -z $PLATFORM ]; then
    echo USAGE: ./pip_install_latest.sh linux_x86_64
    echo    OR: ./pip_install_latest.sh macosx_10_9_x86_64
    echo    OR: ./pip_install_latest.sh macosx_11_0_arm64
    exit 1
fi

BTK_VERSION=$(
    grep current_version `dirname "$0"`/../../.hostbumpversion.cfg \
    | head -n 1 \
    | awk '{print $3}')

python3 setup.py sdist bdist_wheel --python-tag py3 --plat-name=$PLATFORM &&
echo y | pip3 uninstall blobtoolkit-host &&
pip3 install dist/blobtoolkit_host-${BTK_VERSION}-py3-none-$PLATFORM.whl &&
blobtoolkit-host -v
