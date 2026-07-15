<?xml version="1.0" encoding="UTF-8"?>
<core:CityModel
  xmlns:core="http://www.opengis.net/citygml/2.0"
  xmlns:bldg="http://www.opengis.net/citygml/building/2.0"
  xmlns:gml="http://www.opengis.net/gml"
  xmlns:gen="http://www.opengis.net/citygml/generics/2.0"
  gml:id="synthetic-city-model">
  <gml:boundedBy>
    <gml:Envelope srsName="urn:ogc:def:crs:EPSG::25832" srsDimension="3">
      <gml:lowerCorner>691292.100 5336282.771 500.000</gml:lowerCorner>
      <gml:upperCorner>696312.100 5336300.771 532.000</gml:upperCorner>
    </gml:Envelope>
  </gml:boundedBy>

  <!-- A 10 m by 8 m, 12 m tall building just northeast of the project origin. -->
  <core:cityObjectMember>
    <bldg:Building gml:id="synthetic-inside">
      <bldg:class>1000</bldg:class>
      <bldg:function>1000</bldg:function>
      <bldg:roofType>1000</bldg:roofType>
      <bldg:measuredHeight uom="m">12</bldg:measuredHeight>
      <gen:stringAttribute name="fixtureRole">
        <gen:value>inside-clip</gen:value>
      </gen:stringAttribute>
      <bldg:boundedBy>
        <bldg:GroundSurface gml:id="inside-ground">
          <bldg:lod2MultiSurface>
            <gml:MultiSurface srsName="urn:ogc:def:crs:EPSG::25832">
              <gml:surfaceMember>
                <gml:Polygon gml:id="inside-ground-polygon">
                  <gml:exterior><gml:LinearRing>
                    <gml:posList srsDimension="3">691302.100 5336292.771 520 691312.100 5336292.771 520 691312.100 5336300.771 520 691302.100 5336300.771 520 691302.100 5336292.771 520</gml:posList>
                  </gml:LinearRing></gml:exterior>
                </gml:Polygon>
              </gml:surfaceMember>
            </gml:MultiSurface>
          </bldg:lod2MultiSurface>
        </bldg:GroundSurface>
      </bldg:boundedBy>
      <bldg:boundedBy>
        <bldg:RoofSurface gml:id="inside-roof">
          <bldg:lod2MultiSurface>
            <gml:MultiSurface>
              <gml:surfaceMember>
                <gml:Polygon gml:id="inside-roof-polygon">
                  <gml:exterior><gml:LinearRing>
                    <gml:posList srsDimension="3">691302.100 5336292.771 532 691302.100 5336300.771 532 691312.100 5336300.771 532 691312.100 5336292.771 532 691302.100 5336292.771 532</gml:posList>
                  </gml:LinearRing></gml:exterior>
                </gml:Polygon>
              </gml:surfaceMember>
            </gml:MultiSurface>
          </bldg:lod2MultiSurface>
        </bldg:RoofSurface>
      </bldg:boundedBy>
      <bldg:boundedBy>
        <bldg:WallSurface gml:id="inside-wall-south">
          <bldg:lod2MultiSurface><gml:MultiSurface><gml:surfaceMember>
            <gml:Polygon gml:id="inside-wall-south-polygon">
              <gml:exterior><gml:LinearRing><gml:posList srsDimension="3">691302.100 5336292.771 520 691302.100 5336292.771 532 691312.100 5336292.771 532 691312.100 5336292.771 520 691302.100 5336292.771 520</gml:posList></gml:LinearRing></gml:exterior>
            </gml:Polygon>
          </gml:surfaceMember></gml:MultiSurface></bldg:lod2MultiSurface>
        </bldg:WallSurface>
      </bldg:boundedBy>
      <bldg:boundedBy>
        <bldg:WallSurface gml:id="inside-wall-east">
          <bldg:lod2MultiSurface><gml:MultiSurface><gml:surfaceMember>
            <gml:Polygon gml:id="inside-wall-east-polygon">
              <gml:exterior><gml:LinearRing><gml:posList srsDimension="3">691312.100 5336292.771 520 691312.100 5336292.771 532 691312.100 5336300.771 532 691312.100 5336300.771 520 691312.100 5336292.771 520</gml:posList></gml:LinearRing></gml:exterior>
            </gml:Polygon>
          </gml:surfaceMember></gml:MultiSurface></bldg:lod2MultiSurface>
        </bldg:WallSurface>
      </bldg:boundedBy>
      <bldg:boundedBy>
        <bldg:WallSurface gml:id="inside-wall-north">
          <bldg:lod2MultiSurface><gml:MultiSurface><gml:surfaceMember>
            <gml:Polygon gml:id="inside-wall-north-polygon">
              <gml:exterior><gml:LinearRing><gml:posList srsDimension="3">691312.100 5336300.771 520 691312.100 5336300.771 532 691302.100 5336300.771 532 691302.100 5336300.771 520 691312.100 5336300.771 520</gml:posList></gml:LinearRing></gml:exterior>
            </gml:Polygon>
          </gml:surfaceMember></gml:MultiSurface></bldg:lod2MultiSurface>
        </bldg:WallSurface>
      </bldg:boundedBy>
      <bldg:boundedBy>
        <bldg:WallSurface gml:id="inside-wall-west">
          <bldg:lod2MultiSurface><gml:MultiSurface><gml:surfaceMember>
            <gml:Polygon gml:id="inside-wall-west-polygon">
              <gml:exterior><gml:LinearRing><gml:posList srsDimension="3">691302.100 5336300.771 520 691302.100 5336300.771 532 691302.100 5336292.771 532 691302.100 5336292.771 520 691302.100 5336300.771 520</gml:posList></gml:LinearRing></gml:exterior>
            </gml:Polygon>
          </gml:surfaceMember></gml:MultiSurface></bldg:lod2MultiSurface>
        </bldg:WallSurface>
      </bldg:boundedBy>
    </bldg:Building>
  </core:cityObjectMember>

  <!-- Its geometry is valid, but it is roughly five kilometres east of the clip. -->
  <core:cityObjectMember>
    <bldg:Building gml:id="synthetic-outside">
      <bldg:boundedBy>
        <bldg:GroundSurface gml:id="outside-ground">
          <bldg:lod2MultiSurface><gml:MultiSurface><gml:surfaceMember>
            <gml:Polygon gml:id="outside-ground-polygon">
              <gml:exterior><gml:LinearRing><gml:posList srsDimension="3">696302.100 5336292.771 500 696312.100 5336292.771 500 696312.100 5336300.771 500 696302.100 5336300.771 500 696302.100 5336292.771 500</gml:posList></gml:LinearRing></gml:exterior>
            </gml:Polygon>
          </gml:surfaceMember></gml:MultiSurface></bldg:lod2MultiSurface>
        </bldg:GroundSurface>
      </bldg:boundedBy>
    </bldg:Building>
  </core:cityObjectMember>
</core:CityModel>
