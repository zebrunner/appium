package com.zebrunner.mcloud.grid.util;

import org.openqa.selenium.Capabilities;
import java.util.Optional;

public final class CapabilityUtils {

    private CapabilityUtils() {
        //hide
    }

    public static Optional<Object> getAppiumCapability(Capabilities capabilities, String capabilityName) {
        Object value = capabilities.getCapability("appium:" + capabilityName);
        if (value == null) {
            value = capabilities.getCapability(capabilityName);
        }
        return Optional.ofNullable(value);
    }

    public static Optional<Object> getZebrunnerCapability(Capabilities capabilities, String capabilityName) {
        Object value = capabilities.getCapability("zebrunner:" + capabilityName);
        if (value == null) {
            value = capabilities.getCapability("appium:" + capabilityName);
        }
        if (value == null) {
            value = capabilities.getCapability(capabilityName);
        }
        return Optional.ofNullable(value);
    }
}
