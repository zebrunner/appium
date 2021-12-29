#!/bin/bash

#wait until WDA_ENV file exists to read appropriate variables
for ((i=1; i<=$WDA_WAIT_TIMEOUT; i++))
do
 if [ -f ${WDA_ENV} ]
  then
   cat ${WDA_ENV}
   break
  else
   echo "Waiting until WDA settings appear $i sec"
   sleep 1
 fi
done

if [ ! -f ${WDA_ENV} ]; then
  echo "ERROR! Unable to get WDA settings from STF!"
  exit -1
fi

#source wda.env file
source ${WDA_ENV}
. ${WDA_ENV}
export

export AUTOMATION_NAME='XCUITest'
#TODO: move DEVICETYPE into the WDA_ENV
export DEVICETYPE='Phone'
