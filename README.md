# ForgeEvents
ForgeEvents is a website that collects common information about the core part of Minecraft Forge, events.
## Installation
You don't need any preparation in order to contribute to the patch files, however, I strongly recommend setting a few things up
in order to test changes and get a better overview of the structure in general.

* Clone the repository to your local working directory
* Install [node.js](http://nodejs.org/download/)
* Set up a mysql server for the database
* Change the mysql credentials from the file `script/config.json`
* Run `script/install.js`
* Run `script/forgesource.js all`

## Contributing
After you are done with these few steps, you should have a database with a table for each minecraft version.
In order to create new patches, look for entries with missing columns, especially the *description*. You can also override
any *description* if the provided one is incomplete or wrong. Also of special attention is the *side* column as the auto generated
data can only guess it based on the package name.

Server | Client | Both
-------|--------|------
   0   |   1    |  2

**There are a few rules to how the csv patches are structured:**
* You can specify a target with `@@`
  * The initial target is `@`
  * `@` is a wildcard for any version
  * `X.X.X++` includes every version ater the specifed version, including itself
  * `X.X.X--` includes every version prior to the specifed version, including itslef
  * `X.X.X-X.Y.Y` includes every version from X.X.X to X.Y.Y, including themselves
  * You can concat multiple ones of these targets with `;`
* If the patch is dedicated to a single version, create a new file for it or change an existing file named 'X.X.X.csv'
* Order the patches in such a way that the amount of targets specified is down to a minumum
* Don't patch the same Event twice, always look for an existing patch first
* Be precise! Applying a patch to something that doesn't exist makes a difference, performance wise
* Additonally, there are some special statements for use inside a column
  * `@+` in front of a statement will only apply the given data when the source column (Unpatched!) was initially empty
  * `@X.X.X@` will insert the data from the related version (Unpatched!) You can concat as many of these as you like
  * `\,` will escape a comma

#### Bad
````
...
@@1.4.7++,,,
BiomeEvent.GetWaterColor,,forge,1
BiomeEvent.GetGrassColor,,forge,1
@@@,,,
DrawBlockHighlightEvent,Fired on the client when a block is about to be highlighted (mouse over),,
@@1.4.7++,,,
BiomeEvent.GetFoliageColor,,forge,1
...
````
#### Good
````
...
DrawBlockHighlightEvent,Fired on the client when a block is about to be highlighted (mouse over),,
@@1.4.7++,,,
BiomeEvent.GetWaterColor,,forge,1
BiomeEvent.GetGrassColor,,forge,1
BiomeEvent.GetFoliageColor,,forge,1
...
````
*SQL can help, you can for example select any row that doesn't specify a* desciption *with* `SELECT * FROM 1_7_10 WHERE description = ''`

In order to test your changes, run `script/forgesource.js csv`.
