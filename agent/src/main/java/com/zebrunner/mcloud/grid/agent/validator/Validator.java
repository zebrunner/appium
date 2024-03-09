package com.zebrunner.mcloud.grid.agent.validator;

import org.apache.commons.lang3.StringUtils;
import org.openqa.selenium.Capabilities;

import java.util.function.BiFunction;

public interface Validator extends BiFunction<Capabilities, Capabilities, Boolean> {

    default boolean anything(String requested) {
        return StringUtils.equalsAnyIgnoreCase(requested, "ANY", "", "*", null);
    }
}
