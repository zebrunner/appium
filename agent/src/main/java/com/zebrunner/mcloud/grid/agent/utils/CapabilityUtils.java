package com.zebrunner.mcloud.grid.agent.utils;

import org.openqa.selenium.Capabilities;

import java.util.ArrayList;
import java.util.List;

public final class CapabilityUtils {
    private static final String APPIUM_PREFIX = "appium:";
    private static final String ZEBRUNNER_PREFIX = "zebrunner:";

    private CapabilityUtils() {
        //hide
    }

    public static <T> T getAppiumCapability(Capabilities caps, String name, Class<T> expectedType) {
        List<String> possibleNames = new ArrayList<>();
        possibleNames.add(name);
        if (!name.startsWith(APPIUM_PREFIX)) {
            possibleNames.add(APPIUM_PREFIX + name);
        }
        for (String capName : possibleNames) {
            if (caps.getCapability(capName) == null) {
                continue;
            }

            if (expectedType == String.class) {
                return expectedType.cast(String.valueOf(caps.getCapability(capName)));
            }
            if (expectedType.isAssignableFrom(caps.getCapability(capName).getClass())) {
                return expectedType.cast(caps.getCapability(capName));
            }
        }
        return null;
    }

    public static <T> T getZebrunnerCapability(Capabilities caps, String name, Class<T> expectedType) {
        List<String> possibleNames = new ArrayList<>();
        possibleNames.add(name);
        if (!name.startsWith(APPIUM_PREFIX)) {
            possibleNames.add(APPIUM_PREFIX + name);
        }
        if (!name.startsWith(ZEBRUNNER_PREFIX)) {
            possibleNames.add(ZEBRUNNER_PREFIX + name);
        }
        for (String capName : possibleNames) {
            if (caps.getCapability(capName) == null) {
                continue;
            }

            if (expectedType == String.class) {
                return expectedType.cast(String.valueOf(caps.getCapability(capName)));
            }
            if (expectedType.isAssignableFrom(caps.getCapability(capName).getClass())) {
                return expectedType.cast(caps.getCapability(capName));
            }
        }
        return null;
    }
}
