package com.zebrunner.mcloud.grid.agent.validator;

import com.zebrunner.mcloud.grid.agent.utils.CapabilityUtils;
import org.apache.commons.lang3.StringUtils;
import org.openqa.selenium.Capabilities;

import java.lang.invoke.MethodHandles;
import java.util.logging.Logger;

public class DeviceTypeValidator implements Validator {
    private static final Logger LOGGER = Logger.getLogger(MethodHandles.lookup().lookupClass().getName());
    private static final String ZEBRUNNER_DEVICE_TYPE_CAPABILITY = "deviceType";

    @Override
    public Boolean apply(Capabilities stereotype, Capabilities capabilities) {
        String expectedValue = CapabilityUtils.getZebrunnerCapability(capabilities, ZEBRUNNER_DEVICE_TYPE_CAPABILITY, String.class);
        if (anything(expectedValue)) {
            return true;
        }
        String actualValue = CapabilityUtils.getZebrunnerCapability(stereotype, ZEBRUNNER_DEVICE_TYPE_CAPABILITY, String.class);
        if (actualValue == null) {
            return false;
        }
        boolean matches = StringUtils.equalsIgnoreCase(actualValue, expectedValue);
        if (matches) {
            LOGGER.info(() -> String.format("[CAPABILITY-VALIDATOR] device type matches: %s - %s", expectedValue, actualValue));
        } else {
            LOGGER.info(() -> String.format("[CAPABILITY-VALIDATOR] device type does not matches: %s - %s", expectedValue, actualValue));
        }
        return matches;
    }
}
