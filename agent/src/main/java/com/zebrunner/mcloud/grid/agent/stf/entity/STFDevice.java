/*******************************************************************************
 * Copyright 2018-2021 Zebrunner (https://zebrunner.com/).
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *******************************************************************************/

package com.zebrunner.mcloud.grid.agent.stf.entity;

import com.fasterxml.jackson.annotation.JsonAnyGetter;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Getter
@Setter
@NoArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class STFDevice {

    private String abi;
    private Boolean airplaneMode;
    private Battery battery;
    private Browser browser;
    private String channel;
    private String createdAt;
    private Display display;
    private String manufacturer;
    private String model;
    private Network network;
    private Object operator;
    private STFUser owner;
    private Phone phone;
    private String platform;
    private String presenceChangedAt;
    private Boolean present;
    private String product;
    private Provider provider;
    private Boolean ready;
    private Object remoteConnectUrl;
    private Boolean remoteConnect;
    private List<Object> reverseForwards = new ArrayList<>();
    private String sdk;
    private String serial;
    private String statusChangedAt;
    private Double status;
    private Boolean using;
    private String version;
    private String deviceType = "Phone";
    @JsonIgnore
    private Map<String, Object> additionalProperties = new HashMap<>();

    @JsonAnyGetter
    public Map<String, Object> getAdditionalProperties() {
        return this.additionalProperties;
    }

    @JsonAnySetter
    public void setAdditionalProperty(String name, Object value) {
        this.additionalProperties.put(name, value);
    }

    @Override public String toString() {
        return "STFDevice{" +
                "abi='" + abi + '\'' +
                ", airplaneMode=" + airplaneMode +
                ", battery=" + battery +
                ", browser=" + browser +
                ", channel='" + channel + '\'' +
                ", createdAt='" + createdAt + '\'' +
                ", display=" + display +
                ", manufacturer='" + manufacturer + '\'' +
                ", model='" + model + '\'' +
                ", network=" + network +
                ", operator=" + operator +
                ", owner=" + owner +
                ", phone=" + phone +
                ", platform='" + platform + '\'' +
                ", presenceChangedAt='" + presenceChangedAt + '\'' +
                ", present=" + present +
                ", product='" + product + '\'' +
                ", provider=" + provider +
                ", ready=" + ready +
                ", remoteConnectUrl=" + remoteConnectUrl +
                ", remoteConnect=" + remoteConnect +
                ", reverseForwards=" + reverseForwards +
                ", sdk='" + sdk + '\'' +
                ", serial='" + serial + '\'' +
                ", statusChangedAt='" + statusChangedAt + '\'' +
                ", status=" + status +
                ", using=" + using +
                ", version='" + version + '\'' +
                ", deviceType='" + deviceType + '\'' +
                ", additionalProperties=" + additionalProperties +
                '}';
    }
}
