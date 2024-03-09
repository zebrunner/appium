package com.zebrunner.mcloud.grid.agent.validator;

import com.zebrunner.mcloud.grid.agent.util.CapabilityUtils;
import org.apache.commons.lang3.StringUtils;
import org.openqa.selenium.Capabilities;

import java.lang.invoke.MethodHandles;
import java.util.Arrays;
import java.util.Optional;
import java.util.logging.Logger;

public class UDIDValidator implements Validator {
    private static final Logger LOGGER = Logger.getLogger(MethodHandles.lookup().lookupClass().getName());
    private static final String APPIUM_UDID_CAPABILITY = "udid";

    @Override
    public Boolean apply(Capabilities nodeCapabilities, Capabilities requestedCapabilities) {
        String expectedValue = CapabilityUtils.getAppiumCapability(requestedCapabilities, APPIUM_UDID_CAPABILITY, String.class);
        if (anything(expectedValue)) {
            return true;
        }
        String actualValue = CapabilityUtils.getAppiumCapability(nodeCapabilities, APPIUM_UDID_CAPABILITY, String.class);
        if (actualValue == null) {
            return false;
        }
        boolean matches = Arrays.stream(Optional.ofNullable(StringUtils.split(expectedValue, ",")).orElse(new String[] {}))
                .anyMatch(e -> StringUtils.equals(e, actualValue));

        if (matches) {
            LOGGER.info(() -> String.format("[CAPABILITY-VALIDATOR] device udid matches: %s - %s", expectedValue, actualValue));
        } else {
            LOGGER.info(() -> String.format("[CAPABILITY-VALIDATOR] device udid does not matches: %s - %s", expectedValue, actualValue));
        }
        return matches;
    }
}
