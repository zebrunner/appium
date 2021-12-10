#!/bin/bash

#wait until WDA_ENV file exists to read appropriate variables
for ((i=1; i<=$WDA_WAIT_TIMEOUT; i++))
do
 if [ -f ${WDA_ENV} ]
  then
   source ${WDA_ENV}
   break
  else
   echo "Waiting until WDA starts $i sec"
   sleep 1
 fi
done

export AUTOMATION_NAME='XCUITest'
#TODO: move DEVICETYPE into the WDA_ENV
export DEVICETYPE='Phone'
