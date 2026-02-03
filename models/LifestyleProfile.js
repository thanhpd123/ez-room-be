const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const LifestyleProfile = sequelize.define('LifestyleProfile', {
        lifestyle_id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        user_id: {
            type: DataTypes.UUID,
            allowNull: false,
            unique: true,
        },
        sleep_time: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        cleanliness: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        smoking: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
        drinking: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
        pets: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
        personality_type: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
    }, {
        tableName: 'lifestyle_profiles',
        timestamps: false,
    });

    LifestyleProfile.associate = (models) => {
        LifestyleProfile.belongsTo(models.User, {
            foreignKey: 'user_id',
            as: 'user',
        });
    };

    return LifestyleProfile;
};
